import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom' | 'auto';
}

/** Small, keyboard-accessible select used to keep menus consistent across the app. */
export function SelectMenu({ value, options, onChange, ariaLabel, className = '', disabled = false, placement = 'auto' }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [resolvedPlacement, setResolvedPlacement] = useState<'top' | 'bottom'>('bottom');
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const enabledIndices = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const showMenu = (initialIndex?: number) => {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    const nextIndex = initialIndex ?? (selectedIndex >= 0 ? selectedIndex : enabledIndices[0] ?? 0);
    setFocusedIndex(nextIndex);
    const bounds = rootRef.current?.getBoundingClientRect();
    const scrollRegion = rootRef.current?.closest('.view') as HTMLElement | null;
    const regionBounds = scrollRegion?.getBoundingClientRect();
    const above = bounds ? bounds.top - (regionBounds?.top ?? 0) : 0;
    const below = bounds ? (regionBounds?.bottom ?? window.innerHeight) - bounds.bottom : window.innerHeight;
    const nextPlacement = placement === 'auto' ? (below < 260 && above > below ? 'top' : 'bottom') : placement;
    const available = nextPlacement === 'top' ? above : below;
    setResolvedPlacement(nextPlacement);
    setMenuMaxHeight(Math.max(120, Math.min(300, available - 14)));
    setOpen(true);
    requestAnimationFrame(() => {
      if(optionRefs.current[nextIndex])optionRefs.current[nextIndex]?.focus();
      else menuRef.current?.focus();
    });
  };

  const moveFocus = (direction: 1 | -1) => {
    if (!enabledIndices.length) return;
    const position = enabledIndices.indexOf(focusedIndex);
    const nextPosition = (position + direction + enabledIndices.length) % enabledIndices.length;
    const nextIndex = enabledIndices[nextPosition];
    setFocusedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? enabledIndices[0] : enabledIndices.at(-1);
      if (nextIndex !== undefined) {
        setFocusedIndex(nextIndex);
        optionRefs.current[nextIndex]?.focus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('.select-menu-trigger')?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return <div ref={rootRef} className={`select-menu ${className}`}>
    <button
      type="button"
      className="select-menu-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={disabled || options.length === 0}
      onClick={() => open ? setOpen(false) : showMenu()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
          const position = enabledIndices.indexOf(selectedIndex);
          const offset = event.key === 'ArrowDown' ? 1 : -1;
          const next = enabledIndices[(position + offset + enabledIndices.length) % enabledIndices.length] ?? enabledIndices[0];
          if (next !== undefined) showMenu(next);
        } else if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (!open) showMenu();
        }
      }}
    >
      <span className="select-menu-value">{selected?.label ?? ''}</span>
      <Icon name="chevron" className="select-menu-chevron" />
    </button>
    {open && <div ref={menuRef} className={`select-menu-popover ${resolvedPlacement}`} style={{maxHeight:menuMaxHeight}} role="listbox" aria-label={ariaLabel} tabIndex={-1} onKeyDown={handleMenuKeyDown}>
      {options.map((option, index) => <button
        ref={(element) => { optionRefs.current[index] = element; }}
        type="button"
        className={`select-menu-option ${option.value === value ? 'selected' : ''}`}
        role="option"
        aria-selected={option.value === value}
        key={option.value}
        disabled={option.disabled}
        tabIndex={focusedIndex === index ? 0 : -1}
        onFocus={() => setFocusedIndex(index)}
        onMouseEnter={() => setFocusedIndex(index)}
        onClick={() => { onChange(option.value); setOpen(false); rootRef.current?.querySelector<HTMLButtonElement>('.select-menu-trigger')?.focus(); }}
      >
        <span className="select-menu-option-copy"><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span>
        {option.value === value && <span className="select-menu-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}
