/** Host-only encrypted credentials. No raw-key read method is exposed to the renderer. */
export function createCalendarCredentials(db,secureStorage){
 db.exec('CREATE TABLE IF NOT EXISTS publication_calendar_credentials (profile_id TEXT PRIMARY KEY, encrypted_key TEXT NOT NULL)');
 const row=db.prepare('SELECT encrypted_key FROM publication_calendar_credentials WHERE profile_id=?');
 const check=profile=>{if(typeof profile!=='string'||! /^[a-zA-Z0-9_-]{1,120}$/.test(profile))throw Error('Invalid credential profile.');};
 const available=()=>Boolean(secureStorage?.isEncryptionAvailable());
 return {
  status(profile){check(profile);return {configured:Boolean(row.get(profile)),secureStorage:available()};},
  save(profile,key){check(profile);if(!available())throw Error('Secure credential storage is unavailable.');if(typeof key!=='string'||!/^sk_[a-fA-F0-9]{64}$/.test(key))throw Error('Invalid Zernio API key.');const encrypted=secureStorage.encryptString(key).toString('base64');db.prepare('INSERT INTO publication_calendar_credentials VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET encrypted_key=excluded.encrypted_key').run(profile,encrypted);return this.status(profile);},
  remove(profile){check(profile);db.prepare('DELETE FROM publication_calendar_credentials WHERE profile_id=?').run(profile);return this.status(profile);},
  key(profile){check(profile);const value=row.get(profile);if(!value)return '';if(!available())throw Error('Secure credential storage is unavailable.');try{return secureStorage.decryptString(Buffer.from(value.encrypted_key,'base64'))}catch{throw Error('Reconfigure the Zernio API key on this computer.');}},
 };
}
