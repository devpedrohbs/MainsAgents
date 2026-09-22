import type { PageId } from '../../app/types';
import { routes } from '../../app/routes';
import { useWorkspaces } from '../../app/WorkspaceProvider';

interface BreadcrumbsProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
}

export function Breadcrumbs({ page, onNavigate }: BreadcrumbsProps) {
  const { currentWorkspace } = useWorkspaces();
  const items = [currentWorkspace.name, ...routes[page].breadcrumbs.slice(1)];

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const destination = index === 0 ? 'home' : page === 'agent-settings' && index === 1 ? 'agents' : undefined;

        return (
          <span className="breadcrumb-part" key={`${item}-${index}`}>
            {index > 0 && <span className="breadcrumb-separator" aria-hidden="true">/</span>}
            {isLast || !destination ? (
              <strong aria-current={isLast ? 'page' : undefined}>{item}</strong>
            ) : (
              <a href={`#${destination}`} onClick={(event) => { event.preventDefault(); onNavigate(destination); }}>{item}</a>
            )}
          </span>
        );
      })}
    </nav>
  );
}
