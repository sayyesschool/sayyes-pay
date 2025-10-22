import Page from '@/components/page';

export default function MdLayout({ children }) {
  return (
    <Page>
        <article className="legal">
            {children}
        </article>
    </Page>
  );
}
