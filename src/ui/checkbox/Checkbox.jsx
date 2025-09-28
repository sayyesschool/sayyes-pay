export default function Checkbox({
    name,
    value,
    id = `${name}_${value}`,
    label,
    ...props
}) {
    return (
        <div className="checkbox">
            <input
                id={id}
                className="checkbox__input"
                type="checkbox"
                name={name}
                value={value}
                {...props}
            />

            <span className="checkbox__checkmark" />

            {label &&
                <label className="checkbox__label" htmlFor={id}>
                    {label}
                </label>
            }
        </div>
    );
}