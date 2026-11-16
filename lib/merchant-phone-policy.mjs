// Only this explicit server-side setting suspends SMS. Unknown values retain
// the normal verification requirement; client input never controls this flag.
export function merchantPhoneVerificationRequired(env=process.env){
 return env.AIRADAR_MERCHANT_PHONE_VERIFICATION!=='paused';
}
