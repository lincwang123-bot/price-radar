// A numeric-looking alias is still an alias. Only official shop metadata can
// distinguish /shop/S19988 from a canonical shop number of the same shape.
export function canonical16688ShopNo(payload, submitted) {
  const data=payload?.data;
  if(payload?.code!==1 || !/^S\d{1,20}$/.test(data?.shop_no || '')
    || !(data.shop_no===submitted || (typeof data.shop_alias==='string'
      && data.shop_alias.toLowerCase()===submitted.toLowerCase()))) {
    throw new Error('16688 返回的店铺信息无法对应提交的网址');
  }
  return data.shop_no;
}
