' Launcher Platform CGE Indonesia - Tanpa jendela CMD
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Cari lokasi script ini
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Jalankan BAT file secara tersembunyi
strBat = strDir & "\Jalankan_CGE.bat"

If objFSO.FileExists(strBat) Then
    objShell.Run  & strBat & , 1, False
Else
    MsgBox "File Jalankan_CGE.bat tidak ditemukan!" & Chr(13) & _
           "Pastikan semua file ada di folder yang sama.", 16, "Error"
End If
