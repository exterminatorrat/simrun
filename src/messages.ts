export function failureMessage(error:unknown,fallback:string):string {
 let name='',message='';
 if(error instanceof Error){name=error.name;message=error.message;}
 else if(typeof error==='string')message=error;
 else if(error&&typeof error==='object'){
  const value=error as {name?:unknown;message?:unknown};
  if(typeof value.name==='string')name=value.name;
  if(typeof value.message==='string')message=value.message;
 }
 const normalized=`${name} ${message}`.toLowerCase();
 if(/failed to fetch|fetch failed|networkerror|network request failed|network unavailable|load failed|connection (?:refused|reset|timed out)|econn(?:refused|reset)|enotfound/.test(normalized))return 'Network unavailable — check your connection and retry.';
 if(/\b429\b|too many requests/.test(normalized))return 'Provider is busy — wait a moment and retry.';
 if(/\b(?:401|403)\b|unauthorized|forbidden/.test(normalized))return 'The selected provider rejected this request — check its endpoint and access policy.';
 if(/\b5\d\d\b|service unavailable|internal server error/.test(normalized))return 'The selected provider is unavailable — retry later.';
 if(/\b4\d\d\b|bad request|invalid request/.test(normalized))return 'The selected provider rejected this request — check the route or search and retry.';
 if(/quota(?:exceeded| exceeded)|database or disk is full|not enough space|storage is full/.test(normalized))return 'Local storage is full — export a backup or remove activities from History.';
 if(/securityerror|storage is blocked|storage is unavailable|browser storage is unavailable|blocked by (?:the )?browser|indexeddb.*disabled/.test(normalized))return 'Browser storage is unavailable — allow site storage and reload.';
 if(name==='AbortError')return 'Request cancelled.';
 if(name&&name!=='Error')return fallback;
 if(!message||message.length>180||/^(?:typeerror|syntaxerror|referenceerror|rangeerror|domexception|error)(?::|\s|$)/i.test(message.trim())||/cannot read|is not a function|unexpected token|invalid character|failed to execute/.test(normalized))return fallback;
 if(message.length<12)return fallback;
 return message;
}
