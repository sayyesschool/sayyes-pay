export default function Text({ content, children = content, ...props }) {
    return (
        <span className="text" {...props}>{children}</span>
    );
}