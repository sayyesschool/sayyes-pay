import cn from 'classnames';

export default function Tab({
    content,
    icon,
    active,
    onClick,
    ...props
}) {
    return (
        <button
            className={cn('tab', {
                'tab--active': active
            })}
            role="tab"
            onClick={onClick}
            {...props}
        >
            {icon &&
                <span className="tab__icon icon material-symbols-rounded" aria-hidden="true">{icon}</span>
            }

            <span className="tab__content">{content}</span>
        </button>
    );
}