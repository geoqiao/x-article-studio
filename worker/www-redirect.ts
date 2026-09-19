// A separate, redirect-only Worker keeps the editor on static asset hosting.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.host = 'md2xarticle.com';
    url.port = '';
    return Response.redirect(url.toString(), 308);
  },
};
