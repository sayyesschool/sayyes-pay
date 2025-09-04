import cn from 'classnames';

export default function Item({
    icon,
    content,
    meta,
    children = content,
    className,
    iconClassName,
    ...props
}) {
    return (
        <li className={cn('list-item', className)} {...props}>
            {icon &&
                <span className={cn('list-item__icon', iconClassName)}>{icon}</span>
            }

            <span className="list-item__content">{children}</span>
        </li>
    );
}