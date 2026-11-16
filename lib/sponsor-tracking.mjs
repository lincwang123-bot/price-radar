// Only canonical site surfaces are stored. Search terms, UTMs and user data are discarded.
export function sponsorPagePath(rawUrl,campaign){
 if(typeof rawUrl!=='string'||!rawUrl.startsWith('/')||rawUrl.startsWith('//')||rawUrl.length>4096)return '';
 let u;try{u=new URL(rawUrl,'https://airadar.vip');}catch{return '';}
 const english=u.pathname==='/en'||u.pathname.startsWith('/en/');
 const rawPath=english?(u.pathname.slice(3)||'/'):u.pathname;
 const path=rawPath==='/index.html'?'/':rawPath;
 const prefix=english?'/en':'';
 if(campaign?.placement==='sponsored_home'){
  if(path==='/catalog')return prefix+'/catalog';
  // The caller supplies the campaign actually selected by the renderer. Unknown
  // family filters render the home surface too; retain no arbitrary query value.
  if(path==='/'&&!u.searchParams.get('product'))return prefix+'/';
 }
 if(campaign?.placement==='sponsored_category'&&path==='/'&&u.searchParams.get('family')===campaign.page_key&&!u.searchParams.get('product'))return prefix+'/?family='+encodeURIComponent(campaign.page_key);
 if(campaign?.placement==='sponsored_product'){
  if(path==='/prices/'+campaign.page_key||path==='/'&&u.searchParams.get('product')===campaign.page_key)return prefix+'/prices/'+encodeURIComponent(campaign.page_key);
  if(path==='/product'&&u.searchParams.get('source')===campaign.source&&u.searchParams.get('id')===campaign.product_id)return prefix+'/product?'+new URLSearchParams({source:campaign.source,id:campaign.product_id});
 }
 return '';
}

export function sponsorContactHref(campaign,token){
 return campaign?.id&&token?'/sponsor/contact?'+new URLSearchParams({campaign:campaign.id,token}):'';
}
