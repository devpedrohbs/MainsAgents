import { useState } from 'react';
import { saveNow, useSaveStatus } from '../../data/localPersistence';
import { useLanguage } from '../../app/LanguageProvider';

export function SaveIndicator() {
  const {locale}=useLanguage(),status=useSaveStatus();
  const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const pt=locale==='pt-BR';
  const error=status.phase==='error'||Boolean(message);
  async function save() {
    setSaving(true);setMessage('');
    try{await saveNow()}catch{setMessage(pt?'Não foi possível salvar. Exporte um backup nas Configurações.':'Could not save. Export a backup in Settings.')}finally{setSaving(false)}
  }
  return <button className={`save-indicator soft-button ${error?'save-error':''}`} type="button" onClick={()=>void save()} disabled={saving} aria-label={pt?'Salvar agora':'Save now'} title={message||(pt?'Salvamento automático ativo. Clique para salvar agora.':'Autosave is active. Click to save now.')}>
    <i aria-hidden="true"/>
    <span role="status">{error?(pt?'Não salvo':'Not saved'):saving||status.phase==='saving'?(pt?'Salvando…':'Saving…'):(pt?'Salvo':'Saved')}</span>
  </button>;
}
