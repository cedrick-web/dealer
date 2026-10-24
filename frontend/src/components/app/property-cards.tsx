import { useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CircleAlert, Heart, MapPin, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { api, type Listing, type ListingImage } from '@/api';
import { money, photoFor } from '@/lib/property-format';

export function PropertyImage({item,variant='card',onClick}:{item:Listing;variant?:'card'|'modal'|'mini';onClick?:()=>void}) {
  const images=item.images||[];
  const firstImage=images[0];
  const [src,setSrc]=useState(firstImage&&item.status==='published'?api.listingImageUrl(firstImage.publicId):photoFor(item));
  const [hasUploaded,setHasUploaded]=useState(Boolean(firstImage&&item.status==='published'));
  const [loadError,setLoadError]=useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  useEffect(()=>{setActiveIndex(0)},[item.publicId]);
  const currentIndex=Math.min(activeIndex,Math.max(0,images.length-1));
  const uploaded=images[currentIndex];
  useEffect(()=>{
    let active=true;
    let objectUrl:string|undefined;
    setLoadError(false);
    if(!uploaded){
      setSrc(photoFor(item));
      setHasUploaded(false);
      return ()=>{active=false};
    }
    if(item.status==='published'){
      setSrc(api.listingImageUrl(uploaded.publicId));
      setHasUploaded(true);
      return ()=>{active=false};
    }
    setSrc(photoFor(item));
    setHasUploaded(false);
    api.loadListingImage(uploaded.publicId).then(url=>{
      objectUrl=url;
      if(active){setSrc(url);setHasUploaded(true)}
      else URL.revokeObjectURL(url);
    }).catch(()=>{if(active){setLoadError(true);setHasUploaded(false)}});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[item.publicId,item.status,uploaded?.publicId]);
  const movePhoto=(delta:number)=>setActiveIndex(index=>images.length?(index+delta+images.length)%images.length:0);
  const content=<>
    {variant==='card'&&<span className="listing-badge">{item.purpose==='sale'?'FOR SALE':'FOR RENT'}</span>}
    <span className={'photo-proof-tag '+(hasUploaded?'photo-proof-real':'photo-proof-illustration')}>{hasUploaded?(uploaded?.alt||'Seller-uploaded property photo'):'Illustrative image · not the actual property'}</span>
    {variant==='card'&&<span className="photo-location"><MapPin size={13}/>{item.location.sector ? item.location.sector+', ':''}{item.location.district}</span>}
    {images.length>1&&<span className="photo-count-tag">{currentIndex+1} / {images.length} photos</span>}
    {loadError&&<span className="photo-load-warning">Uploaded photo unavailable</span>}
  </>;
  if(variant==='card')return <button type="button" className="listing-photo" style={{backgroundImage:'url('+src+')'}} onClick={onClick} aria-label={'Open '+item.title}>{content}</button>;
  if(variant==='mini')return <div className="compact-property-photo" role="img" aria-label={uploaded?.alt||('Property image for '+item.title)} style={{backgroundImage:'url('+src+')'}}>{content}</div>;
  return <div className="modal-photo" role="group" aria-label={uploaded?.alt||('Property image for '+item.title)} style={{backgroundImage:'url('+src+')'}}>
    {content}
    {images.length>1&&<div className="modal-gallery-controls"><button type="button" onClick={()=>movePhoto(-1)} aria-label="Previous property photo"><ArrowLeft size={17}/></button><span>{currentIndex+1} of {images.length}</span><button type="button" onClick={()=>movePhoto(1)} aria-label="Next property photo"><ArrowRight size={17}/></button></div>}
  </div>;
}

export function PrivateListingImage({image}:{image:ListingImage}) {
  const [src,setSrc]=useState('');
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true;
    let objectUrl:string|undefined;
    setFailed(false);
    api.loadListingImage(image.publicId).then(url=>{
      objectUrl=url;
      if(active)setSrc(url);else URL.revokeObjectURL(url);
    }).catch(()=>{if(active)setFailed(true)});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[image.publicId]);
  if(failed)return <div className="private-image-error"><CircleAlert size={17}/>Photo preview unavailable</div>;
  if(!src)return <div className="private-image-loading"><RefreshCw size={15}/>Loading photo…</div>;
  return <img className="photo-thumb-image" src={src} alt={image.alt||'Uploaded property photo'}/>;
}

export function ListingCard({item,saved,onSave,onOpen,showSave=true}:{item:Listing;saved:boolean;onSave:()=>void;onOpen:()=>void;showSave?:boolean}) {
  return <motion.article className="listing-card" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} whileHover={{y:-3,boxShadow:'0 16px 36px rgba(20,48,34,.10)'}} transition={{duration:.18,ease:'easeOut'}}>
    <PropertyImage item={item} onClick={onOpen}/>
    {showSave&&<button className={'favorite-float '+(saved?'is-saved':'')} onClick={onSave} aria-label={saved?'Remove saved property':'Save property'}><Heart size={18} fill={saved?'currentColor':'none'}/></button>}
    <div className="listing-content">
      <div className="listing-type">{item.propertyType} <span>·</span> Rwanda</div>
      <button className="listing-title" onClick={onOpen}>{item.title}</button>
      <p className="listing-description">{item.description}</p>
      <div className="listing-price-row"><strong>{money(item.price.amount)}</strong>{item.purpose==='rent'&&<span>/ month</span>}<button className="icon-button" onClick={onOpen} aria-label="View property"><ArrowUpRight size={18}/></button></div>
      <div className="listing-trust"><ShieldCheck size={15}/><span>{item.status==='published'?'Moderation approved':'Review pending'}</span><small>{item.status==='published'?'Published listing':'Status pending'}</small></div>
    </div>
  </motion.article>;
}
