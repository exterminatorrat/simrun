/** RFC 4180 field: quote only when the value contains a delimiter, quote or newline. */
export const csvCell=(value:string|number):string=>{const s=String(value);return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
export const csvRow=(...values:(string|number)[]):string=>values.map(csvCell).join(',');
