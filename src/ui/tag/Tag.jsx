import cn from 'classnames';

export default function Tag({
    content,
    icon,
    active,
    onClick,
    ...props
}) {
    return (
        <button
            className={cn('tag', {
                'tag--active': active
            })}
            onClick={onClick}
            {...props}
        >
            {icon &&
                <span className="tag__icon icon material-symbols-rounded" aria-hidden="true">{icon}</span>
            }

            <span className="tag__content">{content}</span>
        </button>
    );
}