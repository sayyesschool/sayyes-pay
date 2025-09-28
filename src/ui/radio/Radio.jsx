export default function Radio({
    name,
    value,
    id = `${name}_${value}`,
    label,
    ...props
}) {
    return (
        <div className="radio">
            <input
                id={id}
                className="radio__input"
                type="radio"
                name={name}
                value={value}
                {...props}
            />

            {label &&
                <label className="radio__label" htmlFor={id}>{label}</label>
            }
        </div>
    );
}