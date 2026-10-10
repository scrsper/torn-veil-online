import {defineConfig} from 'vite';
import {resolve,sep} from 'node:path';
import {readFileSync} from 'node:fs';
import references from './references/manifest.json';
export default defineConfig({base:'/ontology/',resolve:{dedupe:['@babylonjs/core','@babylonjs/loaders']},plugins:[{name:'local-reference-review',configureServer(server){server.middlewares.use((req,res,next)=>{
 const url=(req.url?.split('?')[0]??'').replace(/^\/ontology\//,'/');
 if(url.startsWith('/assets/shared/')){const root=resolve(process.cwd(),'../../web/public'),file=resolve(root,decodeURIComponent(url.slice('/assets/shared/'.length)));if(!file.startsWith(root+sep)){res.statusCode=403;res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.glb')?'model/gltf-binary':'application/json');res.end(readFileSync(file));}catch{res.statusCode=404;res.end('Shared asset missing');}return;}
 if(!url.startsWith('/reference-images/')){next();return;}
 const image=references.images.find(i=>'/reference-images/'+i.id===url);
 if(!image){res.statusCode=404;res.end('Unknown reference');return;}
 try{res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');res.end(readFileSync(image.localPath));}catch{res.statusCode=404;res.end('Run npm run references:verify to copy local references');}
 });}},{name:'reject-missing-shaders',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0].endsWith('.fx')){console.error('Unregistered Babylon shader:',req.url);res.statusCode=404;res.end('Shader must be registered from the Babylon module package');return;}next();});}}]});
