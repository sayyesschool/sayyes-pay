import cn from 'classnames';

import Icon from '../icon';

export default function Button({
    content,
    icon,
    color,
    size,
    full,
    className,
    children = content,
    ...props
}) {
    return (
        <button
            className={cn(className, 'btn', color && `btn--${color}`, full && 'btn--full', size && `btn--${size}`)}
            {...props}
        >
            {icon && <Icon name={icon} />}
            {children}
        </button>
    );
}