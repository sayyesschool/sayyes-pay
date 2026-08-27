import createMDX from '@next/mdx';

const withMDX = createMDX({
    extension: /\.(md|mdx)$/
});

export default withMDX({
    pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
    reactStrictMode: true,
        async rewrites() {
                    return [
      // Картинки старого сайта отдаются только по своему домену (защита от хотлинка),
      // поэтому тянем их через себя: браузер видит только sayyestoenglish.com.
      { source: '/wp/:path*', destination: 'https://sayyes.school/wp-content/:path*' },
                        {
                                            source: '/learn_easy',
                                            destination: '/learn_easy.html'
                        }
                                ];
        }
});
