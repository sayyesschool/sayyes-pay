import cn from 'classnames';

import Icon from '../icon';

export default function Button({
    content,
    icon,
    color,
    full,
    loading,
    outlined,
    size,
    className,
    children = content,
    ...props
}) {
    return (
        <button
            className={cn(
                className, 'btn',
                color && `btn--${color}`,
                full && 'btn--full',
                loading && 'btn--loading',
                outlined && 'btn--outlined',
                size && `btn--${size}`
            )}
            {...props}
        >
            {icon && <Icon name={icon} />}
            {children}
        </button>
    );
}