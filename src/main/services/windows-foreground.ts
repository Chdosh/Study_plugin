import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ForegroundWindowInfo {
  appName: string;
  windowTitle: string | null;
}

export async function getForegroundWindowInfo(): Promise<ForegroundWindowInfo> {
  if (process.platform !== 'win32') {
    return {
      appName: 'Unsupported platform',
      windowTitle: null
    };
  }

  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Window {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [Win32Window]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 512
[void][Win32Window]::GetWindowText($handle, $title, $title.Capacity)
$processId = 0
[void][Win32Window]::GetWindowThreadProcessId($handle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
[PSCustomObject]@{
  appName = if ($process) { $process.ProcessName } else { "Unknown" }
  windowTitle = $title.ToString()
} | ConvertTo-Json -Compress
`;

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ]);
  const parsed = JSON.parse(stdout.trim()) as ForegroundWindowInfo;
  return {
    appName: parsed.appName || 'Unknown',
    windowTitle: parsed.windowTitle || null
  };
}
