# The encrypted MCP store stays shared. Give the isolated Codex home access to
# its existing encryption key in Windows Credential Manager. Never print the key.
$ErrorActionPreference = 'Stop'
$sourceTarget = $env:MAINSAGENTS_SOURCE_CREDENTIAL
$destinationTarget = $env:MAINSAGENTS_DESTINATION_CREDENTIAL
if ($sourceTarget -notmatch '^secrets\|[0-9a-f]{16}\.codex$' -or $destinationTarget -notmatch '^secrets\|[0-9a-f]{16}\.codex$') {
    throw 'Invalid Codex credential target.'
}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MainsCodexCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredFree")]
    private static extern void Free(IntPtr credential);
    public static bool ShareKey(string source, string destination) {
        IntPtr pointer;
        if (!Read(source, 1, 0, out pointer)) {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) return false; // Source has no file-backed MCP key yet.
            throw new Win32Exception(error);
        }
        try {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            credential.TargetName = destination;
            credential.UserName = destination.Substring(0, destination.Length - ".codex".Length);
            if (!Write(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return true;
        } finally { Free(pointer); }
    }
}
'@
$null = [MainsCodexCredential]::ShareKey($sourceTarget, $destinationTarget)
