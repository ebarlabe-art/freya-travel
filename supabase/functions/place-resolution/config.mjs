export function placeConfig(env=()=>undefined){
 const read=(key,fallback,min,max)=>{const raw=env(key),n=raw===undefined?fallback:Number(raw);if(!Number.isInteger(n)||n<min||n>max)throw Error('invalid_config');return n};
 return Object.freeze({timeoutMs:read('PLACE_TIMEOUT_MS',8000,1000,15000),cacheSeconds:read('PLACE_CACHE_SECONDS',86400,60,604800),emptySeconds:read('PLACE_EMPTY_SECONDS',300,1,3600),tokenSeconds:read('PLACE_TOKEN_SECONDS',900,60,3600),userDaily:read('PLACE_USER_DAILY',100,1,10000),globalDaily:read('PLACE_GLOBAL_DAILY',2500,1,100000),globalPerSecond:read('PLACE_GLOBAL_RPS',4,1,100),maxResults:5});
}
