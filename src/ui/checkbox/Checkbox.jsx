export default function Checkbox({
    name,
    value,
    id = `${name}_${value}`,
    label,
    onChange,
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
                onInput={onChange}
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