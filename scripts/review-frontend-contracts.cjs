// Read-only source/contract review. No HTTP requests or real database calls.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const frontend = path.resolve(process.argv[2] || path.join(root, '..', 'joe-wilson-portfolio-main', 'joe-wilson-portfolio-main'));
const read = file => fs.readFileSync(file, 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const service = { id, slug: 'live-performance', title: 'Performance', isPublished: true, orderIndex: 0 };
const calls = [];
let responseFor = url => url.startsWith('/services/') ? { service, relatedServices: [] } : [];
const client = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(method => [method, (url, body) => {
  calls.push({ method: method.toUpperCase(), url, body });
  return Promise.resolve({ data: { success: true, data: responseFor(url) } });
}]));
const loaded = new Map();
function load(file) {
  file = path.resolve(file);
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} }; loaded.set(file, module);
  const source = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = name => {
    if (name.startsWith('@joe-wilson/shared/')) return load(path.join(frontend, 'shared', name.slice('@joe-wilson/shared/'.length) + '.ts'));
    if (name === './client') return { apiClient: client };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
    if (name === '@/lib/api-response') return load(path.join(frontend, 'apps/client/src/lib/api-response.ts'));
    if (name === '@/lib/api') return load(path.join(frontend, 'apps/admin/src/lib/api.ts'));
    if (name === './services.api') return load(path.join(frontend, 'apps/client/src/api/services.api.ts'));
    if (name === '@/assets/home/basemasterclass2.jpg') return { default: 'review-placeholder.jpg' };
    throw new Error('Unexpected runtime import in review: ' + name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

function backendRoutes() {
  const app = read(path.join(root, 'src/app.ts'));
  const imports = new Map([...app.matchAll(/import (\w+) from '(\.\/modules\/[^']+)';/g)].map(m => [m[1], m[2]]));
  const routes = [];
  for (const mount of app.matchAll(/app\.use\('(\/v1[^']+)',\s*(\w+)\)/g)) {
    const file = imports.get(mount[2]); if (!file) continue;
    for (const route of read(path.join(root, 'src', file + '.ts')).matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      routes.push({ method: route[1].toUpperCase(), url: mount[1] + (route[2] === '/' ? '' : route[2]) });
    }
  }
  return routes;
}
function matches(template, url) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + template.split('/').map(segment => segment === '*' ? '.*' : segment.startsWith(':') ? '[^/]+' : escape(segment)).join('/') + '/?$').test(url);
}

async function main() {
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@localhost:5432/test',JWT_SECRET:'x'.repeat(64),JWT_REFRESH_SECRET:'y'.repeat(64),REDIS_URL:'redis://localhost:6379',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',RESEND_API_KEY:''});
 const admin=load(path.join(frontend,'apps/admin/src/api/admin.api.ts')).adminApi;
 const testimonial={id,createdAt:'2026-01-01',quote:'Great',authorName:'Review',authorOrg:null,avatarUrl:'',isFeatured:true,orderIndex:0};
 const event={id,title:'Concert',description:'Details',location:'Accra',eventDate:'2026-11-01T12:00:00Z',isPublished:false};
 const course={id,title:'Class',description:'Description',priceCents:1000,status:'upcoming',startsAt:event.eventDate,endsAt:'2026-12-01T12:00:00Z',isPublished:false};
 const session={id,title:'Lesson',orderIndex:0,scheduledAt:'',videoMediaId:'',liveStreamUrl:''};
 const args={login:['review@example.test','Password123'],updateMe:[{firstName:'Review'}],masterclass:[id],createMasterclass:[course],updateMasterclass:[id,course],deleteMasterclass:[id],createSession:[id,session],updateSession:[id,session],deleteSession:[id],createTestimonial:[testimonial],updateTestimonial:[id,testimonial],deleteTestimonial:[id],updateSettings:[{booking_email:'booking@example.test'}],uploadMedia:[new File(['review'],'review.txt',{type:'text/plain'})],deleteMedia:[id],transcode:[id],retryTranscode:[id],resources:[{masterclassId:id}],createResource:[{mediaId:id,masterclassId:id,label:'Notes',orderIndex:0}],updateResource:[id,{label:'Notes',orderIndex:1}],deleteResource:[id],replyInquiry:[id,'Reply'],handleInquiry:[id],updateQuote:[id,'booked'],user:[id],refundPayment:[id],createService:[service],updateService:[id,service],deleteService:[id],createEvent:[event],updateEvent:[id,event],deleteEvent:[id]};
 const inventory=[];
 for(const [name,fn]of Object.entries(admin)){const start=calls.length;await fn(...(args[name]||[]));for(const call of calls.slice(start))inventory.push({app:'admin',operation:name,...call});}
 const profile={firstName:'Review',lastName:'User',email:'review@example.test',password:'Password123'};
 const clientArgs={register:[profile],registerWithProfile:[profile],login:[{email:profile.email,password:profile.password}],refresh:['placeholder'],forgotPassword:[{email:profile.email}],resetPassword:[{token:'a'.repeat(64),password:profile.password}],updateMe:[{firstName:'Review'}],getById:[id],getSessions:[id],getBySlug:['live-performance'],updateProgress:[id,{watchedSeconds:1}],createCheckout:[{masterclassId:id,successUrl:'https://site.example/checkout?success=true',cancelUrl:'https://site.example/checkout'}]};
 for(const filename of fs.readdirSync(path.join(frontend,'apps/client/src/api')).filter(f=>f.endsWith('.api.ts'))){const exports=load(path.join(frontend,'apps/client/src/api',filename));for(const [apiName,api]of Object.entries(exports))for(const [name,fn]of Object.entries(api)){const start=calls.length;await fn(...(name==='submit'?[filename==='quotes.api.ts'?{fullName:'Review',email:profile.email,service:'live-performance'}:{name:'Review',email:profile.email,message:'Hello'}]:clientArgs[name]||[]));for(const call of calls.slice(start))inventory.push({app:'client',operation:apiName+'.'+name,...call});}}
 const routes=backendRoutes();for(const item of inventory){item.url='/v1'+item.url;item.routeExists=routes.some(r=>r.method===item.method&&matches(r.url,item.url));}
 const missing=inventory.filter(i=>!i.routeExists);assert.deepEqual(missing,[]);
 const schemaCases=[['createSession',require('../dist/modules/masterclasses/admin.masterclasses.controller').createSessionSchema],['createTestimonial',require('../dist/modules/testimonials/testimonials.schema').createSchema],['updateTestimonial',require('../dist/modules/testimonials/testimonials.schema').updateSchema],['createService',require('../dist/modules/services/services.schema').createSchema],['updateService',require('../dist/modules/services/services.schema').updateSchema],['createEvent',require('../dist/modules/events/events.schema').createSchema],['updateEvent',require('../dist/modules/events/events.schema').updateSchema],['createMasterclass',require('../dist/modules/masterclasses/admin.masterclasses.controller').createMasterclassSchema],['paymentsApi.createCheckout',require('../dist/modules/payments/payments.controller').checkoutSchema]];
 for(const [name,schema]of schemaCases){const call=inventory.find(i=>i.operation===name);const result=schema.safeParse(call.body);assert.ok(result.success,name+': '+JSON.stringify(result.error?.issues));}
 const servicesApi=load(path.join(frontend,'apps/client/src/api/services.api.ts')).servicesApi;assert.equal((await servicesApi.getBySlug('live-performance')).id,id);
 const errors=load(path.join(frontend,'shared/lib/errors.ts'));assert.deepEqual(errors.parseApiError({isAxiosError:true,response:{status:400,data:{success:false,error:'Validation failed',details:{fieldErrors:{title:['Required']},formErrors:[]}}}}).fieldErrors,{title:['Required']});
 const mapper=load(path.join(frontend,'apps/client/src/lib/mappers/masterclass.mapper.ts'));assert.equal(mapper.mapSessionToUi({id,title:'Lesson',orderIndex:10,status:'upcoming'},0).sessionNumber,1);
 const resource={id,label:'PDF',mediaId:id,orderIndex:0,media:{id,filename:'notes.pdf',fileType:'document',mimeType:'application/pdf',sizeBytes:'1024',url:'https://example.test/notes.pdf'}};assert.equal(mapper.mapResourceToUi(resource).url,resource.media.url);
 const report={date:'2026-10-26',status:'passed',scope:'Local adapter execution against backend route inventory and validation schemas; no live provider or database calls',capturedCalls:inventory.length,schemaChecks:schemaCases.length,missingRoutes:missing,endpointInventory:inventory.map(({body,...item})=>item)};
 fs.writeFileSync(path.join(root,'docs/frontend-contract-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,capturedCalls:report.capturedCalls,schemaChecks:report.schemaChecks,missingRoutes:missing},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
