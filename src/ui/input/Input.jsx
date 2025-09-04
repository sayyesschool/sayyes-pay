import cn from 'classnames';

export default function Input({
    invalid,
    ...props
}) {
    return (
        <input className={cn('input', { 'input--invalid': invalid })} {...props} />
    );
}