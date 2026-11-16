/* Native anchors keep filters usable without JavaScript; measure only the
   existing sticky header so fragment destinations are not covered by it. */
(() => {
 'use strict';
 const header=document.querySelector('.app-header');
 if(!header||!document.getElementById('quote-filters'))return;
 const measure=()=>document.documentElement.style.setProperty('--quote-anchor-offset',Math.ceil(header.getBoundingClientRect().height+12)+'px');
 measure();
 if('ResizeObserver' in window)new ResizeObserver(measure).observe(header);
 else window.addEventListener('resize',measure,{passive:true});
 window.addEventListener('load',()=>{
  measure();
  if(performance.getEntriesByType('navigation')[0]?.type==='back_forward')return;
  const id=location.hash.slice(1);
  if(!['quote-filters','quote-results'].includes(id))return;
  const target=document.getElementById(id);
  if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true});}
 },{once:true});
})();
