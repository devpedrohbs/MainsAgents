import { FlowDialog } from '../common/FlowDialog';
import { Icon, type IconName } from '../common/Icon';
import { useLanguage } from '../../app/LanguageProvider';

export function QuickCreate({
  onClose,
  onAgent,
  onTask,
  onSession,
  onNote,
  onContent,
}: {
  onClose: () => void;
  onAgent: () => void;
  onTask: () => void;
  onSession: () => void;
  onNote: () => void;
  onContent: () => void;
}) {
  const { locale, t } = useLanguage();
  const pt = locale === 'pt-BR';
  const options: { label: string; detail: string; icon: IconName; action: () => void }[] = [
    {
      label: t('New session'),
      detail: pt ? 'Escolha um agente e comece uma conversa.' : 'Choose an agent and start a conversation.',
      icon: 'message',
      action: onSession,
    },
    {
      label: t('New Task'),
      detail: pt ? 'Organize uma entrega no quadro.' : 'Organize a deliverable on the board.',
      icon: 'board',
      action: onTask,
    },
    {
      label: t('Create agent'),
      detail: pt
        ? 'Defina um especialista, ferramentas e skills.'
        : 'Define a specialist, tools, and skills.',
      icon: 'users',
      action: onAgent,
    },
    {
      label: pt ? 'Nota no Canvas' : 'Canvas note',
      detail: pt
        ? 'Capture uma ideia sem abrir uma conversa.'
        : 'Capture an idea without starting a conversation.',
      icon: 'note',
      action: onNote,
    },
    {
      label: pt ? 'Pauta de conteúdo' : 'Content topic',
      detail: pt
        ? 'Pesquise, revise e transforme em roteiro.'
        : 'Research, review, and turn it into a script.',
      icon: 'script',
      action: onContent,
    },
  ];
  return (
    <FlowDialog title={pt ? 'O que você quer criar?' : 'What would you like to create?'} onClose={onClose}>
      <div className="flow-options">
        {options.map((option) => (
          <button
            className="flow-option"
            key={option.label}
            onClick={() => {
              onClose();
              option.action();
            }}
          >
            <span className="flow-option-icon">
              <Icon name={option.icon} />
            </span>
            <span>
              <b>{option.label}</b>
              <small>{option.detail}</small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
    </FlowDialog>
  );
}
