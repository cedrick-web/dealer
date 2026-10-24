import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { ArrowRight, Building2, FileCheck2, LockKeyhole, Sparkles, Upload, X } from 'lucide-react';
import type { ListingImage } from '@/api';
import { Field } from '@/components/app/common';
import { PrivateListingImage } from '@/components/app/property-cards';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type ListingEditorForm = {
  title:string;
  description:string;
  propertyType:string;
  purpose:string;
  district:string;
  sector:string;
  price:string;
};
export type NewListingPhotoDraft = {clientId:string;file:File;altText:string};
export type ListingPhotoPreview = {clientId:string;url:string};

export function ListingEditorView({
  form, setForm, districts, editing, existingImages, newPhotos, photoPreviews, busy,
  onSubmit, onSelectPhotos, onRemoveExisting, onRemoveNew, onNewPhotoAltChange,
}:{
  form:ListingEditorForm;
  setForm:Dispatch<SetStateAction<ListingEditorForm>>;
  districts:string[];
  editing:boolean;
  existingImages:ListingImage[];
  newPhotos:NewListingPhotoDraft[];
  photoPreviews:ListingPhotoPreview[];
  busy:boolean;
  onSubmit:FormEventHandler<HTMLFormElement>;
  onSelectPhotos:(files:FileList|null)=>void;
  onRemoveExisting:(image:ListingImage)=>void;
  onRemoveNew:(clientId:string)=>void;
  onNewPhotoAltChange:(clientId:string,value:string)=>void;
}) {
  return (
    <section className="view-content form-layout">
      <form className="panel editor-panel" onSubmit={onSubmit}>
        <div className="panel-heading"><div><h3>{editing?'Edit property information':'Property information'}</h3><p>{editing?'Save a revised listing. It will be paused from public search until the review team approves the updated details.':'Complete the facts buyers need to make a useful first decision.'}</p></div><span className="step-count">{editing?'REVISION':'01 / 02'}</span></div>
        <div className="form-grid">
          <Field label="Listing title"><Input required minLength={8} maxLength={120} value={form.title} onChange={e=>setForm(previous=>({...previous,title:e.target.value}))} placeholder="e.g. Three-bedroom house near transport"/></Field>
          <Field label="Property type"><select value={form.propertyType} onChange={e=>setForm(previous=>({...previous,propertyType:e.target.value}))}><option value="house">House</option><option value="apartment">Apartment</option><option value="land">Land</option><option value="commercial">Commercial</option><option value="room">Room</option></select></Field>
          <Field label="Purpose"><select value={form.purpose} onChange={e=>setForm(previous=>({...previous,purpose:e.target.value}))}><option value="sale">For sale</option><option value="rent">For rent</option></select></Field>
          <Field label="Asking price (RWF)"><Input required type="number" min="1" step="1" value={form.price} onChange={e=>setForm(previous=>({...previous,price:e.target.value}))} placeholder="Enter amount in Rwandan francs"/></Field>
          <Field label="District"><select required value={form.district} onChange={e=>setForm(previous=>({...previous,district:e.target.value}))}>{(districts.length?districts:['Gasabo','Kicukiro','Nyarugenge']).map(d=><option key={d}>{d}</option>)}</select></Field>
          <Field label="Sector / neighborhood"><Input value={form.sector} maxLength={80} onChange={e=>setForm(previous=>({...previous,sector:e.target.value}))} placeholder="Sector or local area"/></Field>
          <Field label="Detailed description" wide><Textarea required minLength={30} maxLength={3000} rows={6} value={form.description} onChange={e=>setForm(previous=>({...previous,description:e.target.value}))} placeholder="Describe condition, rooms, access, utilities, land size (if applicable), known restrictions and what needs independent confirmation."/><small className="field-help">{form.description.length}/3000 characters. Do not place national ID numbers or sensitive personal information in this public description.</small></Field>
          <div className="field field-wide">
            <span>Property photos (optional, up to 6)</span>
            <div className="photo-upload-panel">
              <p>Upload real photos of the advertised property. JPEG, PNG and WebP are accepted, up to 8 MiB each. Your listing goes back to review whenever a photo is added or removed.</p>
              <div className="photo-upload-toolbar"><label className="btn btn-outline photo-select-button"><Upload size={15}/>Choose photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{onSelectPhotos(e.target.files);e.currentTarget.value=''}}/></label><span>{existingImages.length+newPhotos.length}/6 photos</span></div>
              {existingImages.length>0&&<div className="photo-upload-group"><b>Already uploaded</b><div className="photo-editor-grid">{existingImages.map(image=><div className="photo-editor-card existing" key={image.publicId}><PrivateListingImage image={image}/><span className="photo-editor-alt">{image.alt||'Property photo'}</span><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={()=>onRemoveExisting(image)}><X size={13}/>Remove</button></div>)}</div></div>}
              {newPhotos.length>0&&<div className="photo-upload-group"><b>New photos</b><div className="photo-editor-grid">{newPhotos.map(photo=>{const preview=photoPreviews.find(item=>item.clientId===photo.clientId);return <div className="photo-editor-card" key={photo.clientId}>{preview&&<img className="photo-thumb-image" src={preview.url} alt={photo.altText}/>}<label className="photo-alt-input">Photo description<Input value={photo.altText} maxLength={180} onChange={e=>onNewPhotoAltChange(photo.clientId,e.target.value)} placeholder="e.g. Front view of the house"/></label><button type="button" className="btn btn-outline btn-sm" onClick={()=>onRemoveNew(photo.clientId)}><X size={13}/>Remove</button></div>})}</div></div>}
              {existingImages.length+newPhotos.length===0&&<div className="photo-upload-empty"><Building2 size={19}/><span>No seller photos are attached yet. Listings without uploaded photos will show a no-photo state, never a stock picture of a different property.</span></div>}
            </div>
          </div>
        </div>
        <div className="review-explainer"><LockKeyhole size={19}/><div><b>{editing?'Revision returns to review':'Private until review'}</b><p>{editing?'Saving revised details pauses public visibility and resets moderation to pending review. This prevents outdated details from continuing to circulate.':"Your new listing is stored as pending review. It won't show up publicly unless an administrator approves it. Platform review is not proof of legal ownership."}</p></div></div>
        <div className="form-footer"><span>By submitting, you confirm you have permission to advertise the property.</span><button className="btn btn-primary" disabled={busy} type="submit">{busy?(editing?'Saving…':'Submitting…'):editing?'Save and resubmit':'Submit for review'}<ArrowRight size={16}/></button></div>
      </form>
      <aside className="panel side-checklist"><div className="checklist-icon"><FileCheck2 size={22}/></div><h3>Before you publish</h3><p>High-quality listings are specific, truthful and supported by evidence.</p>{['Provide accurate asking price and location','Describe condition and relevant limitations','Upload evidence from your listing after submission','Verify ownership and parcel details independently','Agree agent fees in writing before moving forward'].map((item,index)=><div className="checklist-item" key={item}><span>{index+1}</span>{item}</div>)}<div className="tip-box"><Sparkles size={16}/><span>Strong descriptions answer the practical questions buyers normally ask first.</span></div></aside>
    </section>
  );
}
