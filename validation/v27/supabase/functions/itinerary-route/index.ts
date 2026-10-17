import {serveValidated} from '../_shared/validation-auth.mjs';
import {createRouteHandler} from './handler.mjs';
import {routeBackend} from './backend.mjs';
import {routeProvider} from './provider.mjs';
serveValidated(createRouteHandler({
 ...routeBackend({url:Deno.env.get('SUPABASE_URL')!,anon:Deno.env.get('SUPABASE_ANON_KEY')!}),
 provider:routeProvider({key:Deno.env.get('GEOAPIFY_API_KEY')}),
}));
