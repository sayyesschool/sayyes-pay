export default function Modal({
    open,
    title,
    children,
    onClose,
    ...props
}) {
    return (
        <div className={`modal ${open ? 'modal--open' : ''}`} {...props}>
            <div className="modal__surface">
                <button className="modal__close" onClick={onClose}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L17 17M17 1L1 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>

                <div className="modal__body">
                    <div className="modal__header">
                        <h2 className="modal__title">{title}</h2>
                    </div>

                    <div className="modal__content">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}