# Publicação e recuperação do MainsAgents (Windows)

Versão atual: 0.3.0. O instalador NSIS usa o mesmo `appId` entre versões. O perfil de dados fica em `%APPDATA%\mains-agents`, separado dos arquivos instalados.

## Antes da publicação

1. Atualize a versão em `package.json` e `package-lock.json` e revise o README.
2. Rode `npm ci`, `npm run typecheck`, `npm run build` e `npm run desktop:dist` em Windows.
3. Instale a nova versão sobre a anterior em uma máquina de teste. Confirme versão em **Settings**, histórico, atalhos, importação de backup, sessão Codex e uso offline.
4. Confira `release/MainsAgents-Setup-<versão>.exe` e registre `Get-FileHash -Algorithm SHA256` do instalador antes de divulgar. Anexe o hash ao release.
5. Se houver certificado de assinatura de código, configure a assinatura no processo de build e verifique a assinatura do executável e instalador. Não publique um artefato como assinado sem essa verificação.

## Rollback

1. Exporte um backup em **Settings → Your data** antes de trocar de versão, quando possível.
2. Reinstale o último instalador validado. O instalador não remove o perfil em `%APPDATA%\mains-agents`.
3. Se o esquema de dados mudou, importe o backup criado na versão anterior. Não apague o perfil para tentar corrigir um erro de instalação.

O banco IndexedDB é atualizado de forma aditiva. Alterações futuras incompatíveis devem incluir migração testada e não devem sobrescrever dados desconhecidos.

## Limitações atuais

Não existe canal de atualização automática. A atualização é feita instalando uma versão nova sobre a anterior. O projeto não possui certificado de assinatura comercial; isso precisa ser providenciado antes de distribuição ampla.
