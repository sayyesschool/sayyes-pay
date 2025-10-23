const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/thanks/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}