export default function Hero({
    title,
    description,
    content,
    image,
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

            {image && (
                <div className="hero__image">
                    {image}
                </div>
            )}
        </div>
    );
}