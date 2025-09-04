export default function Hero({
    title,
    description,
    content,
    centered,
    children = content,
    ...props
}) {
    return (
        <div className="hero" {...props}>
            <div className="hero__content">
                <h1 className="hero__title">
                    {title}
                </h1>

                <p className="hero__description">
                    {description}
                </p>

                {children}
            </div>
        </div>
    );
}