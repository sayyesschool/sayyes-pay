import Page from '@/components/page';

export const metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default function LegalLayout({ children }) {
  return (
    <Page>
        <article className="legal">
            {children}
        </article>
    </Page>
  );
}
