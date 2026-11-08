import { next, rewrite } from '@vercel/functions';

export default function proxy(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'sso.pbpii.or.id') return next();
  url.pathname = '/sso.html';
  return rewrite(url);
}