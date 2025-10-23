import '@/styles/global.scss';

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" />
        <link rel="icon" href="/favicon-192x192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/favicon-180x180.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&family=Shantell+Sans:ital,wght@1,300..400&display=swap" />
        <link rel="stylesheet" href="https://s3.regru.cloud/sayyes-static/styles/shared.css" />
        <link rel="stylesheet" href="https://sayyes.school/wp-content/themes/sayyes/static/styles/main.css" />
      </head>

      <body>
        {children}
      </body>
    </html>
  );
}
