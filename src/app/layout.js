import '@/styles/global.css';

import { UserProvider } from '@/features/user/client';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&family=Shantell+Sans:ital,wght@1,300..400&display=swap" />
        <link rel="stylesheet" href="https://s3.regru.cloud/sayyes-static/styles/shared.css"></link>
        {/* <script src="https://s3.regru.cloud/sayyes-static/scripts/shared.js" async></script> */}
      </head>

      <body>
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
