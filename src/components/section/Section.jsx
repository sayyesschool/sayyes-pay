import cn from 'classnames';

export default function Section({
    id,
    title,
    description,
    header,
    content,
    color,
    centered,
    padded,
    children = content,
    ...props
}) {
    return (
        <section
            id={id}
            className={cn("section", color && `section--${color}`, {
                "section--centered": centered,
                "section--padded": padded
            })}
            {...props}
        >
            <div className="section__container">
                {(title || description || header) &&
                    <div className="section__header">
                        {title &&
                            <h2 className="section__title">{title}</h2>
                        }

                        {description &&
                            <p className="section__description">{description}</p>
                        }

                        {header}
                    </div>
                }

                <div className="section__content">
                    {children}
                </div>
            </div>
        </section>
    );
}