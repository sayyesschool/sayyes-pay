import createMDX from '@next/mdx';

const withMDX = createMDX({
    extension: /\.(md|mdx)$/
});

export default withMDX({
    pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
    reactStrictMode: true
});
