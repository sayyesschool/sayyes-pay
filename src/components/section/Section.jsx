import cn from 'classnames';

export default function Section({ title, header, content, centered, children = content, ...props }) {
    return (
        <section
            className={cn("section", {
                "section--centered": centered
            })}
            {...props}
        >
            <div className="section__container">
                {(title || header) &&
                    <div className="section__header">
                        {title &&
                            <h2 className="section__title">{title}</h2>
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