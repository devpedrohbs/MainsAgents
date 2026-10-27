// Agent avatars are variations of the MainsAgents conductor (BrandMark): shape, colour, the object in hand and the eyes.
// Geometry lives on the same 64-unit grid as the brand mark so every variation keeps the bow tie and the eyes in place.

export type MascotShape='classic'|'round'|'square'|'ghost'|'robot';
export type MascotProp='baton'|'pencil'|'clapper'|'brush'|'megaphone'|'none';
export type MascotMood='normal'|'happy'|'focused';
export interface AgentMascot {shape:MascotShape;color:string;prop:MascotProp;mood:MascotMood}

export const mascotShapes:Record<MascotShape,{label:[string,string];path:string}>={
 classic:{label:['Clássico','Classic'],path:'M14 30 A18 18 0 0 1 50 30 V46 Q50 54 41 57 L32 49 L23 57 Q14 54 14 46 Z'},
 round:{label:['Redondo','Round'],path:'M32 12 C45 12 51 22 51 34 C51 47 43 56 32 56 C21 56 13 47 13 34 C13 22 19 12 32 12 Z'},
 square:{label:['Quadrado','Square'],path:'M19 15 H45 Q51 15 51 21 V48 Q51 54 45 54 H19 Q13 54 13 48 V21 Q13 15 19 15 Z'},
 ghost:{label:['Fantasma','Ghost'],path:'M14 30 A18 18 0 0 1 50 30 V55 L44 51 L38 55 L32 51 L26 55 L20 51 L14 55 Z'},
 robot:{label:['Robô','Robot'],path:'M19 19 H45 Q50 19 50 24 V48 Q50 53 45 53 H19 Q14 53 14 48 V24 Q14 19 19 19 Z M31 19 V12 H33 V19 Z M29 9 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0'},
};
/** `stroke` paths are drawn as lines (the baton), the rest are filled. */
export const mascotProps:Record<MascotProp,{label:[string,string];fill:string;stroke?:string}>={
 baton:{label:['Batuta','Baton'],fill:'M50.6 39 a3.4 3.4 0 1 0 6.8 0 a3.4 3.4 0 1 0 -6.8 0',stroke:'M55 37 L61 24'},
 pencil:{label:['Lápis','Pencil'],fill:'M53 46 L59 28 L62.5 29.2 L56.5 47.2 L53.2 49 Z'},
 clapper:{label:['Claquete','Clapper'],fill:'M51 31 H63 V42 H51 Z M51 28.5 L62.5 25 L63 27.6 L51.5 31 Z'},
 brush:{label:['Pincel','Brush'],fill:'M59 22 L62 23 L58 36 L55 35 Z M54 36.5 Q50.5 40.5 52.5 45 Q57 43 57.5 37.5 Z'},
 megaphone:{label:['Megafone','Megaphone'],fill:'M53 34 L61 28 V45 L53 39 Z M50 34.5 H53 V38.5 H50 Z'},
 none:{label:['Nenhum','None'],fill:''},
};
export const mascotMoods:Record<MascotMood,{label:[string,string];path:string;line:boolean}>={
 normal:{label:['Normal','Normal'],path:'M23.4 29 a2.6 3.6 0 1 0 5.2 0 a2.6 3.6 0 1 0 -5.2 0 M35.4 29 a2.6 3.6 0 1 0 5.2 0 a2.6 3.6 0 1 0 -5.2 0',line:false},
 happy:{label:['Feliz','Happy'],path:'M23 30.5 Q26 25.5 29 30.5 M35 30.5 Q38 25.5 41 30.5',line:true},
 focused:{label:['Focado','Focused'],path:'M23 29.5 H29 M35 29.5 H41',line:true},
};
export const mascotColors:readonly (readonly [string,string,string])[]=[
 ['Azul','Blue','#5b8cff'],['Laranja','Orange','#e8875f'],['Âmbar','Amber','#f5b544'],['Verde','Green','#3ecf8e'],['Turquesa','Teal','#2dd4bf'],
 ['Rosa','Pink','#f472b6'],['Lilás','Lilac','#a78bfa'],['Vermelho','Red','#f87171'],['Cinza','Grey','#a1a1a6'],['Branco','White','#ededed'],
];
export const mascotBowTie='M28.5 39 L32 41 L28.5 43 Z M35.5 39 L32 41 L35.5 43 Z';

const has=<T extends string>(record:Record<T,unknown>,value:unknown):value is T=>typeof value==='string'&&Object.hasOwn(record,value);
export function isAgentMascot(value:unknown):value is AgentMascot{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const item=value as Record<string,unknown>;
 return Object.keys(item).every(key=>['shape','color','prop','mood'].includes(key))&&has(mascotShapes,item.shape)&&has(mascotProps,item.prop)&&has(mascotMoods,item.mood)
  &&typeof item.color==='string'&&/^#[0-9a-f]{6}$/i.test(item.color);
}

const hash=(text:string)=>[...text].reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,7);
/** Default look for an agent that never chose one: colour from the name, object from the role. Stable across sessions. */
export function defaultMascot({name,role=''}:{name:string;role?:string}):AgentMascot{
 const text=`${role} ${name}`.toLowerCase();
 const prop:MascotProp=/roteir|script|writer|redat|copy/.test(text)?'pencil':/v[íi]deo|edit|corte|motion/.test(text)?'clapper':/design|capa|cover|thumb|arte/.test(text)?'brush':/public|agend|social|post/.test(text)?'megaphone':'baton';
 return {shape:'classic',color:mascotColors[hash(name||'agent')%(mascotColors.length-2)][2],prop,mood:'normal'};
}
export function randomMascot(random=Math.random):AgentMascot{
 const pick=<T,>(list:readonly T[])=>list[Math.floor(random()*list.length)];
 return {shape:pick(Object.keys(mascotShapes) as MascotShape[]),color:pick(mascotColors)[2],prop:pick(Object.keys(mascotProps) as MascotProp[]),mood:pick(Object.keys(mascotMoods) as MascotMood[])};
}
