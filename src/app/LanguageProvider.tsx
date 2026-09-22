import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import { usePersistentState } from '../data/localPersistence';

export type AppLocale = 'en-US' | 'pt-BR';

const pt: Record<string, string> = {
  Home:'Início', Board:'Quadro', Canvas:'Canvas', Agents:'Agentes', Sessions:'Sessões', Settings:'Configurações', Workspace:'Workspace', Search:'Buscar', New:'Novo',
  General:'Geral', Models:'Modelos', Shortcuts:'Atalhos', Language:'Idioma', 'Interface language':'Idioma da interface', 'Choose the language used throughout MainsAgents.':'Escolha o idioma usado em todo o MainsAgents.',
  'General preferences for {{name}} and its agents.':'Preferências gerais para {{name}} e seus agentes.', 'Agent activity':'Atividade dos agentes', 'Show concise tool activity inside conversations.':'Mostrar atividades de ferramentas de forma discreta nas conversas.',
  'Keep canvas context':'Manter contexto do Canvas', 'Attach selected canvas objects when starting a new session.':'Anexar objetos selecionados do Canvas ao iniciar uma sessão.', 'Reduced motion':'Movimento reduzido', 'Minimize interface transitions and canvas feedback.':'Reduzir transições da interface e feedback do Canvas.',
  'Your team':'Sua equipe', 'Specialists with clear roles, tools, and working context.':'Especialistas com funções, ferramentas e contexto de trabalho claros.', 'Create agent':'Criar agente',
  'Agent configuration':'Configuração do agente', 'New specialist':'Novo especialista', Identity:'Identidade', 'How this agent appears across the workspace.':'Como este agente aparece no workspace.', Name:'Nome', Role:'Função', Description:'Descrição', Behavior:'Comportamento', Instructions:'Instruções',
  'Set the permanent context this agent should follow.':'Defina o contexto permanente que este agente deve seguir.', Tools:'Ferramentas', 'Choose what this agent can access in the prototype.':'Escolha o que este agente pode acessar.', Skills:'Skills', 'Install a skill or point this agent to a folder containing SKILL.md files.':'Instale uma skill ou indique uma pasta com arquivos SKILL.md.',
  'Skills folder':'Pasta de skills', 'No folder selected':'Nenhuma pasta selecionada', 'Choose folder':'Escolher pasta', 'Install from GitHub':'Instalar do GitHub', 'Install skill':'Instalar skill', 'Installing…':'Instalando…', Cancel:'Cancelar', 'Save changes':'Salvar alterações',
  'Name and role are required.':'Nome e função são obrigatórios.', 'Delete agent':'Excluir agente', 'This permanently removes the local agent and its configuration.':'Isso remove permanentemente o agente local e sua configuração.', 'Confirm delete':'Confirmar exclusão', Delete:'Excluir',
  'Agent settings':'Configurações do agente', 'Define the role, tools, skills, and default working behavior.':'Defina a função, ferramentas, skills e comportamento padrão.', 'Back to agents':'Voltar para agentes', 'Edit agent':'Editar agente',
  'Mission Control':'Central de controle', 'See what is moving, where attention is needed, and what your agents delivered.':'Veja o que está em andamento, o que precisa de atenção e o que seus agentes entregaram.', 'agents working':'agentes trabalhando', 'needs your attention':'precisa da sua atenção', 'tasks completed today':'tarefas concluídas hoje',
  'Working now':'Em andamento', 'active tasks':'tarefas ativas', 'Needs your attention':'Precisa da sua atenção', Review:'Revisar', 'Recently completed':'Concluídas recentemente', 'delivered today':'entregues hoje',
  'Track work without losing the agent, sources, or output behind it.':'Acompanhe o trabalho sem perder o agente, as fontes ou o resultado.', Filter:'Filtrar', Research:'Pesquisa', Running:'Em andamento', Done:'Concluído',
  'Agent history':'Histórico dos agentes', 'Each conversation keeps its own messages, agent, and working context.':'Cada conversa mantém suas próprias mensagens, agente e contexto.', 'New session':'Nova sessão', 'Deleted agent':'Agente excluído', 'Independent session':'Sessão independente',
  Workspaces:'Workspaces', Rename:'Renomear', Save:'Salvar', 'New workspace':'Novo workspace', 'Codex connected':'Codex conectado',
  Chat:'Chat', Context:'Contexto', Idle:'Ocioso', Thinking:'Pensando', Searching:'Pesquisando', 'Tool usage':'Usando ferramenta', Finished:'Concluído', Error:'Erro', You:'Você', 'All sessions':'Todas as sessões', Copy:'Copiar', 'Add to Canvas':'Adicionar ao Canvas', 'Added to Canvas':'Adicionado ao Canvas', Active:'Ativa', Confirm:'Confirmar',
  'Agent context':'Contexto do agente', 'Local agent configuration':'Configuração local do agente', 'Canvas context will include selected objects when Codex is connected.':'O contexto do Canvas incluirá os objetos selecionados quando o Codex estiver conectado.', 'Cancel execution':'Cancelar execução', Send:'Enviar', Web:'Web',
  'Ready':'Pronto', 'Needs review':'Precisa de revisão', Completed:'Concluído', 'tools':'ferramentas', 'items':'itens', 'item':'item',
  Note:'Nota', Image:'Imagem', Add:'Adicionar', 'Content idea':'Ideia de conteúdo', Hook:'Hook', Script:'Roteiro', 'Ask Agent':'Perguntar ao agente', 'Send to Agent':'Enviar ao agente', Duplicate:'Duplicar', Connect:'Conectar', Group:'Agrupar', selected:'selecionados',
  'Command palette':'Paleta de comandos', 'No results':'Nenhum resultado', 'Try another name or command.':'Tente outro nome ou comando.', Navigate:'Navegar', Open:'Abrir', Close:'Fechar', Actions:'Ações', Tasks:'Tarefas',
  'New Agent':'Novo agente', 'New Task':'Nova tarefa', 'New Session':'Nova sessão', 'Add Note':'Adicionar nota', 'Add Image':'Adicionar imagem', 'Open Canvas':'Abrir Canvas', 'Open Board':'Abrir Quadro', 'Open Agent':'Abrir agente', 'Switch Workspace':'Trocar workspace',
  'Folder selection is available in the desktop app.':'A seleção de pasta está disponível no aplicativo desktop.', 'No SKILL.md files found in this folder.':'Nenhum arquivo SKILL.md foi encontrado nesta pasta.', 'Enter a skill repository.':'Informe um repositório de skill.', 'Skill installation is available in the desktop app.':'A instalação de skills está disponível no aplicativo desktop.', 'Could not install this skill.':'Não foi possível instalar esta skill.',
  'Web Search':'Pesquisa na Web', Files:'Arquivos', 'Canvas Context':'Contexto do Canvas', Subagents:'Subagentes', 'Search and read public sources.':'Pesquisar e ler fontes públicas.', 'Read files attached to the workspace.':'Ler arquivos anexados ao workspace.', 'Read selected nodes and create canvas results.':'Ler nodes selecionados e criar resultados no Canvas.', 'Delegate focused work to other agents.':'Delegar trabalhos específicos a outros agentes.',
};

interface LanguageContextValue { locale:AppLocale; setLocale:(locale:AppLocale)=>void; t:(text:string,values?:Record<string,string|number>)=>string }
const LanguageContext=createContext<LanguageContextValue|null>(null);

export function LanguageProvider({children}:PropsWithChildren) {
  const [locale,setLocale]=usePersistentState<AppLocale>('language','en-US');
  useEffect(()=>{document.documentElement.lang=locale},[locale]);
  const value=useMemo<LanguageContextValue>(()=>({locale,setLocale,t:(text,values)=>{
    let translated=locale==='pt-BR'?(pt[text]??text):text;
    for(const [key,value] of Object.entries(values??{}))translated=translated.replaceAll(`{{${key}}}`,String(value));
    return translated;
  }}),[locale,setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage():LanguageContextValue { const value=useContext(LanguageContext);if(!value)throw new Error('useLanguage must be used inside LanguageProvider');return value; }
