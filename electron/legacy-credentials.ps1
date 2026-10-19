param([switch]$ReadAuth, [switch]$ReadLastfm, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CherryLegacyCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public uint Flags, Type;
    public IntPtr TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist, AttributeCount;
    public IntPtr Attributes, TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    if (!System.Text.RegularExpressions.Regex.IsMatch(target, @"^(ytmusic-session(?:\.p(?:0|[1-9][0-9]{0,2}))?\.(?:cherry|xylo)|secret\.lastfm\.cherry)$"))
      throw new InvalidOperationException("Unknown legacy credential");
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      if (Marshal.GetLastWin32Error() == 1168) return null;
      throw new InvalidOperationException("Credential Manager unavailable");
    }
    try {
      var value = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      if (value.CredentialBlobSize > 1048576 || value.CredentialBlobSize % 2 != 0)
        throw new InvalidOperationException("Invalid legacy credential");
      return Marshal.PtrToStringUni(value.CredentialBlob, (int)value.CredentialBlobSize / 2);
    } finally { CredFree(pointer); }
  }
}
'@
  # Used by fixture tests: compile and verify ABI layout without reading any credentials.
  if ($ValidateOnly) {
    $expected = if ([IntPtr]::Size -eq 8) { 80 } else { 52 }
    if ([Runtime.InteropServices.Marshal]::SizeOf([type][CherryLegacyCredentialReader+Credential]) -ne $expected) { throw 'Invalid ABI' }
    [Console]::Write('valid')
    exit 0
  }
  $entries = @{}
  if ($ReadAuth) {
    foreach ($service in @('cherry', 'xylo')) {
      $target = "ytmusic-session.$service"
      $raw = [CherryLegacyCredentialReader]::Read($target)
      if ($null -eq $raw) { continue }
      $entries[$target] = $raw
      # Inspect only the bounded manifest; Node validates the assembled session.
      $manifest = ConvertFrom-Json -InputObject $raw
      if ($null -ne $manifest.v) {
        if ($manifest.v -ne 2 -or $manifest.parts -isnot [int] -or $manifest.parts -lt 1 -or $manifest.parts -gt 256) { throw 'Invalid manifest' }
        for ($index = 0; $index -lt $manifest.parts; $index++) {
          $part = "ytmusic-session.p$index.$service"
          $entries[$part] = [CherryLegacyCredentialReader]::Read($part)
        }
      }
      break
    }
  }
  if ($ReadLastfm) { $entries['secret.lastfm.cherry'] = [CherryLegacyCredentialReader]::Read('secret.lastfm.cherry') }
  [Console]::Write((ConvertTo-Json -InputObject $entries -Depth 4 -Compress))
} catch {
  # Never include the exception or input: JSON/interop errors can contain secrets.
  [Console]::Error.Write('Could not read legacy Cherry credentials.')
  exit 1
}
