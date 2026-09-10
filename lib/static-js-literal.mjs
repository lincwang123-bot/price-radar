// A deliberately small data reader, not a JavaScript evaluator. Accept only
// literal arrays/objects/scalars; reject calls, expressions, spreads and getters.
export function readAssignedLiteral(script,name){
 const fail=()=>{throw Object.assign(new Error('公开静态目录不是完整字面量'),{code:'INVALID_CATALOG'});};
 if(typeof script!=='string'||Buffer.byteLength(script)>512*1024||!/^\w+$/.test(name))fail();
 const match=new RegExp(`(?:^|[;\\n])\\s*const\\s+${name}\\s*=\\s*`).exec(script);if(!match)fail();
 let pos=match.index+match[0].length,nodes=0;
 const ws=()=>{while(/\s/.test(script[pos]||'')&&pos<script.length)pos++;};
 function string(){const quote=script[pos++];let out='';while(pos<script.length){const c=script[pos++];if(c===quote)return out;if(c==='\n'||c==='\r')fail();if(c!=='\\'){out+=c;continue;}
  const e=script[pos++],esc={'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','\\':'\\',"'":"'",'"':'"','/':'/'};
  if(e==='u'){const h=script.slice(pos,pos+4);if(!/^[a-f\d]{4}$/i.test(h))fail();out+=String.fromCharCode(parseInt(h,16));pos+=4;}else if(Object.hasOwn(esc,e))out+=esc[e];else fail();}fail();}
 function value(depth=0){ws();if(++nodes>5000||depth>12)fail();const c=script[pos];if(c==='"'||c==="'")return string();
  if(c==='['||c==='{'){const array=c==='[',end=array?']':'}',out=array?[]:Object.create(null);pos++;ws();if(script[pos]===end){pos++;return out;}
   while(pos<script.length){let key;if(!array){ws();const quoted=script[pos]==='"'||script[pos]==="'";key=quoted?string():script.slice(pos).match(/^(?:[A-Za-z_$][\w$]*|\d+)/)?.[0];if(!key)fail();if(!quoted)pos+=key.length;ws();if(script[pos++]!==':'||['__proto__','constructor','prototype'].includes(key)||Object.hasOwn(out,key))fail();}
    const v=value(depth+1);if(array)out.push(v);else out[key]=v;ws();if(script[pos]===end){pos++;return out;}if(script[pos++]!==',')fail();ws();if(script[pos]===end){pos++;return out;}
   }fail();
  }
  const token=script.slice(pos).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?)(?![\w.])/);if(!token)fail();pos+=token[0].length;const v=JSON.parse(token[0]);if(typeof v==='number'&&!Number.isFinite(v))fail();return v;
 }
 const result=value();ws();if(script[pos]!==';')fail();return result;
}
