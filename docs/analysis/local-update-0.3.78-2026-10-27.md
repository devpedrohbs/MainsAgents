# Atualização local 0.3.78 — 27/10/2026

**Instalada localmente em 27/10/2026, às 14:50 (America/Sao_Paulo), sobre a 0.3.77.** NSIS silencioso por usuário com retorno 0, versão e hashes conferidos, dados preservados. Sem release pública; o commit local fica com o coordenador.

## Escopo

Entrega de todo o checkout congelado pelo coordenador: navegação e fluxo visual, organização por conteúdo, canvas e suas correções de estado/Undo/isolamento, avatares e anexos, dados de uso, chat com modelos e passos de execução e correções finais de entregas/exclusão. Inclui o editor em três etapas e todos os demais ajustes anteriores presentes no código.

`package.json` e as duas identidades do lockfile estão sincronizados em **0.3.78**. A instalação anterior tem FileVersion `0.3.77`, ProductVersion `0.3.77.0` e `app.asar` SHA-256 `192f7b0c4255e661b457bc8254cb1ea33c33f2e872b926ce23c99ceb88dcdf54`, correspondente a `release/r77/`.

## Backup e preservação

Antes da preparação, `scripts/local-update-backup.mjs activity` confirmou `active:false`, nenhum processo do aplicativo, job ou turno aberto. O app estava fechado e não precisou ser interrompido.

Backup externo ao Git:

```text
C:/Users/pacas/.mainsagents/backups/local-update-0.3.78-2026-10-27/
```

- Nove bancos pela API de backup online do SQLite, incluindo WAL comprometido; todos com `integrity_check=ok`.
- 141 arquivos locais, 16 arquivos de sessões do runtime, uma imagem gerada e 72 arquivos auxiliares do perfil.
- 42 arquivos de guias/skills; complemento de 15 pastas de skills com 63 arquivos, incluindo seus recursos.
- Auditoria adicional fora do checkout calcula hashes de todas as linhas de todas as tabelas dos nove bancos, dos arquivos locais e dos recursos das skills, sem expor conteúdo das linhas no relatório.
- Credenciais e configurações de autenticação não são alteradas; o perfil pessoal não é aberto para validar o pacote.

## Fixtures corrigidas

As verificações úteis foram preservadas, atualizando expectativas anteriores ao fluxo de três etapas:

- `scripts/test-content-sessions-ui.mjs`: revisão de cortes em A/B, sem seletor prematuro de motion; aprovar somente cortes leva A ao SRT e mantém B inalterado; o seletor aguarda a carga do conteúdo após reabrir.
- `scripts/test-session-recovery-ui.mjs`: ajuste real da etapa de cortes e seletores estáveis de navegação; conserva recuperação de thread, ausência de reenvio, histórico, rascunhos e teclado.
- `scripts/test-provider-editor-choice-ui.mjs`: “Enviar vídeo e preparar cortes”; conserva diretor/modelo/retomada e prova que escolher um diretor não inicia uma execução.

Os três testes passaram no renderer preliminar e novamente no **dist final**: `CONTENT_SESSIONS_UI_OK`, `SESSION_RECOVERY_UI_OK`, `PROVIDER_EDITOR_CHOICE_UI_OK`.

## Build final e validação

- Congelamento da implementação confirmado pelo coordenador após a correção de `captureChatDelivery`, que preserva o conteúdo de uma sessão já vinculada.
- Inventário congelado: **390 arquivos**, SHA-256 `99519681c02ef336fb05508c58690165d668844f55de59eca9e4a9c9a5e25286`.
- `npm run build` aprovado: TypeScript, Vite, preview autocontido, Remotion e Whisper verificado.
- Bundle Remotion versionado: `3404bdd9a71e549b`; etapa `--release` aprovada.
- Grafo do runtime: **109 módulos, nenhum ausente**.
- Coordenador confirmou, no dist final: `UX_FLOW_UI_OK`, `REFINED_WORKSPACE_UI_OK`, `CANVAS_SYSTEM_UI_OK` e `CHAT_TIMING_UI_OK` (todos saída 0).
- Pasta nova de empacotamento: `release/r78-20261027/`, sem reutilizar instaladores anteriores.
- Build equivalente ao `desktop:dist`, completo: `npm run build`, `node scripts/build-remotion-video.mjs --release`, `node scripts/check-build-files.mjs`, `npx electron-builder --win nsis --publish never "--config.directories.output=release/r78-20261027"` e `MAINSAGENTS_RELEASE_DIR=release/r78-20261027 node scripts/check-desktop-release.mjs`.
- Conferência extra de **230 entradas**: 229 arquivos de runtime/dist byte a byte, mais identidade e dependências de runtime do `package.json` (o electron-builder remove seus metadados de desenvolvimento). Inventário das 390 fontes permaneceu inalterado. Nenhum arquivo de lease/staging, perfil pessoal ou pasta de trabalho local entrou no ASAR.
- Perfil isolado do pacote: `PACKAGED_NATIVE_PERSISTENCE_UI_OK`, `PACKAGED_MEDIA_OK`, `PACKAGED_CONTENT_SESSIONS_OK` e `PACKAGED_CONTENT_FLOW_OK`, todos saída 0. A jornada de mídia usou FFmpeg, Remotion, Whisper dos recursos empacotados e exportação de vídeo/SRT sintéticos; nenhum vídeo ou perfil pessoal foi usado.
- Suíte completa executada pelo coordenador: **844 testes, 843 aprovados, uma falha, zero skipped**. A única falha foi um `EPERM` ao renomear uma pasta temporária do teste de rotação 90/270 no Windows; sem alterar código, o coordenador repetiu o caso isoladamente e ele passou (**1/1**, saída 0). Não se afirma aprovação de 844/844 numa única execução. Logs: `.mainsagents-workspaces/update-0.3.78-unit.log` e `update-0.3.78-rotation-recheck.log`.

## Pacote e instalação verificados

| Item | Resultado |
| --- | --- |
| Instalador | `release/r78-20261027/MainsAgents-Setup-0.3.78.exe` |
| Instalador SHA-256 | `05d1674a77fee224bcbc38b75f9263383a9244c415851b6cb2a55cc8f09042a7` |
| ASAR do pacote e instalado SHA-256 | `dcae863f9915a1a82f8dd834654809601d557d479efa9d7230582f0ef29d2e7b` |
| Destino canônico | `C:/Users/pacas/AppData/Local/Programs/MainsAgents/MainsAgents.exe` |
| FileVersion / ProductVersion | `0.3.78` / `0.3.78.0` |
| Instalação | `Start-Process -WindowStyle Hidden`, NSIS `/S /currentuser /D=…`, retorno **0** |
| Atalhos | Desktop e menu Iniciar apontam para o executável canônico |
| Estado após instalação | App fechado; `active:false`; nenhum job ou turno aberto |

Imediatamente antes de instalar, a atividade foi conferida novamente. O snapshot lógico ainda era igual ao backup preliminar, portanto o backup corresponde ao estado efetivamente substituído. Foram comparados `before-install.json` e `after-install.json` com `--strict-leases`; a auditoria adicional de todas as linhas das nove bases e dos recursos de skills/arquivos também permaneceu **idêntica**, SHA-256 `4f34d89e5f1d4ff42297cf0f641c4123d19136a697f3fa2b6b6c4b01a6e1d7eb` antes e depois. Nenhum agente, conversa, rascunho, tarefa, canvas, configuração, credencial ou skill foi editado para instalar.

Recibos detalhados, cópias e auditorias ficam exclusivamente na pasta externa de backup indicada acima. Recibos públicos de artefato local em `release/r78-20261027/MainsAgents-0.3.78-verification.json` e `source-verification.json`; esses arquivos e binários são ignorados pelo Git.

O instalador não tem assinatura digital comercial (`NotSigned`); os SHA-256 foram registrados para identificar exatamente esta entrega. A aplicação pessoal não foi iniciada para testes, evitando retomar produções do usuário. O worker não fez `git add`, commit, push, tag ou release pública; o coordenador é responsável pelo commit local solicitado.
