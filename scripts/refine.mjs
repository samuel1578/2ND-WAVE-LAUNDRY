import fs from 'node:fs';
const replace=(file,fn)=>fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));
replace('src/lib/mock-store.ts',s=>s.replace('let state={','let state:{bookings:Booking[];leads:Lead[];content:ContentItem[];media:MediaAsset[];settings:Settings}={'));
replace('src/components/forms/booking.tsx',s=>s.replace('photoRef.current=photos;','useEffect(()=>{photoRef.current=photos;},[photos]);'));
replace('src/components/admin/content-admin.tsx',s=>{const i=s.indexOf('function ContentEditor');return s.slice(0,i).replace(/\bmodule\b/g,'moduleName').replace(/\.moduleName/g,'.module').replace(/moduleName={moduleName}/g,'module={moduleName}')+s.slice(i);});
replace('src/components/gallery.tsx',s=>s.replace('gallery.filter((p,i)=>','gallery.filter(p=>'));
replace('src/app/globals.css',s=>s.replace("@import url('data:text/css,');\n",''));
replace('src/lib/content.ts',s=>s.replace("photos.batch_7_commercial_laundry?.[0]:undefined","photos.services_index?.find(p=>/bedding/i.test(p.alt)):undefined"));
replace('package.json',s=>{const p=JSON.parse(s);for(const section of ['dependencies','devDependencies'])for(const name of Object.keys(p[section]))p[section][name]=JSON.parse(fs.readFileSync('node_modules/'+name+'/package.json','utf8')).version;return JSON.stringify(p,null,2)+'\n';});
