import '@/styles/global.scss';

export const metadata = {
  title: {
    default: 'Say Yes to English — Онлайн-школа английского для детей и взрослых | Индивидуальные и групповые занятия, разговорный клуб ',
    template: '%s | Say Yes to English'
  },
  description: 'Учите английский с удовольствием! Онлайн-школа Say Yes to English предлагает индивидуальные и групповые занятия для взрослых и детей любого уровня. Современные методики, опытные преподаватели, разговорный клуб и гибкий график. Начни говорить по-английски уверенно уже сегодня! ',
  keywords: ['онлайн-школа английского', 'курсы английского онлайн', 'индивидуальные занятия английским', 'групповые уроки английского', 'разговорный клуб', 'английский для детей', 'английский для взрослых', 'изучение английского онлайн', 'репетитор английского', 'английский по Zoom', 'разговорный английский', 'English online school', 'Say Yes to English' ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1
    }
  }
};

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
