const formatter=zone=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function zonedDateTime(iso,zone){if(!iso)return '';const parts=Object.fromEntries(formatter(zone).formatToParts(new Date(iso)).map(item=>[item.type,item.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
/** Reject DST gaps/overlaps rather than silently scheduling at a different local hour. */
export function localTimeToInstant(value,zone){
  if(!value)return undefined;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a complete date and time.');
  const wall=Date.parse(value+'Z');if(!Number.isFinite(wall))throw new Error('Choose a valid date.');
  const matches=[];
  for(let offset=-840;offset<=840;offset+=15){const instant=new Date(wall-offset*60000).toISOString();if(zonedDateTime(instant,zone)===value)matches.push(instant);}
  if(matches.length!==1)throw new Error(matches.length?'This local hour occurs twice. Choose another hour.':'This local hour does not exist. Choose another hour.');
  return matches[0];
}
